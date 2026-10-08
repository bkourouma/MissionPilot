"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { TypeDocument } from "@missionpilot/shared";
import { ChoixFichier } from "../../../../../components/fichiers/ChoixFichier";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../../components/ui/CaseACocher";
import { Champ } from "../../../../../components/ui/Champ";
import { Select } from "../../../../../components/ui/Select";
import { api, ErreurApi } from "../../../../../lib/api";
import {
  memeContenu,
  messageDocument,
  validerDepot,
  type ChampDepot,
  type ChargeDepot,
  type VersionDocument,
} from "../../../../../lib/documents";
import {
  empreinteSha256,
  erreurReprenable,
  nomSansExtension,
  type FichierTeleverse,
} from "../../../../../lib/fichiers";
import { OPTIONS_TYPES_DOCUMENT } from "../../../../../lib/missions";
import { televerser } from "../../../../../lib/televersement";

export interface DepotDocumentProps {
  missionId: string;
  /** Types que l'utilisateur peut déposer. */
  typesPermis: TypeDocument[];
  /** Documents existants (versions courantes) : même type et même nom → version suivante. */
  existants: readonly VersionDocument[];
  /** Nouvelle version d'un document : type et nom imposés. */
  version?: VersionDocument;
  onFin: () => void;
  onDepose: (message: string) => void;
}

const MESSAGE_IDENTIQUE =
  "Ce fichier est identique à la version courante du document : aucune nouvelle version n'a été créée.";

const RAPPELS_FICHIER: Record<string, string> = {
  CONTENU_IDENTIQUE: "Fichier identique à la version courante : choisissez un autre fichier.",
  TYPE_FICHIER_REFUSE: "Fichier refusé par le serveur : choisissez-en un autre.",
  FICHIER_TROP_VOLUMINEUX: "Fichier trop volumineux : 15 Mo au plus.",
};

/** Retire sans attendre un fichier téléversé resté sans rattachement (quota d'attente). */
function retirerOrphelin(id: string | null) {
  if (id) void api.supprimer(`/api/fichiers/${encodeURIComponent(id)}`).catch(() => undefined);
}

/**
 * Dépôt d'un document ou d'une nouvelle version (SOC-05) : le fichier est téléversé
 * (POST /api/fichiers), puis rattaché à la mission (POST /api/missions/:id/documents). Un fichier
 * identique à la version courante est repéré AVANT l'envoi quand le navigateur sait calculer
 * l'empreinte (connexion épargnée), sinon par l'API (409 CONTENU_IDENTIQUE). Après une coupure
 * entre les deux étapes, « Réessayer » rattache le fichier déjà envoyé sans le renvoyer.
 */
export function DepotDocument({
  missionId,
  typesPermis,
  existants,
  version,
  onFin,
  onDepose,
}: DepotDocumentProps) {
  const [type, setType] = useState<string>(
    version?.type ?? (typesPermis.includes("livrable") ? "livrable" : (typesPermis[0] ?? "")),
  );
  const [nom, setNom] = useState(version?.nom ?? "");
  const [nomSaisi, setNomSaisi] = useState(Boolean(version));
  const [brouillonIa, setBrouillonIa] = useState(false);
  const [fichier, setFichier] = useState<File | null>(null);
  const [progression, setProgression] = useState<number | null>(null);
  const [erreurFichier, setErreurFichier] = useState<string | null>(null);
  const f = useFormulaire<ChampDepot>();
  // Fichier déjà téléversé mais pas encore rattaché (reprise après coupure).
  const enAttente = useRef<{ fichier: File; id: string } | null>(null);

  useEffect(() => () => retirerOrphelin(enAttente.current?.id ?? null), []);

  const courante =
    version ??
    existants.find((d) => d.type === type && d.nom.trim() === nom.trim() && nom.trim() !== "");

  async function deposer(c: ChargeDepot, f0: File): Promise<VersionDocument> {
    if (courante?.fichier) {
      const sha = await empreinteSha256(await f0.arrayBuffer());
      if (memeContenu(sha, courante))
        throw new ErreurApi("CONTENU_IDENTIQUE", MESSAGE_IDENTIQUE, 409);
    }
    let fichierId = enAttente.current?.fichier === f0 ? enAttente.current.id : null;
    if (!fichierId) {
      retirerOrphelin(enAttente.current?.id ?? null);
      enAttente.current = null;
      setProgression(0);
      try {
        const t = await televerser<FichierTeleverse>("/api/fichiers", f0, f0.name, {
          onProgression: setProgression,
        });
        fichierId = t.id;
        enAttente.current = { fichier: f0, id: t.id };
      } finally {
        setProgression(null);
      }
    }
    try {
      const d = await api.post<VersionDocument>(
        `/api/missions/${encodeURIComponent(missionId)}/documents`,
        { ...c, fichier_id: fichierId },
      );
      enAttente.current = null;
      return d;
    } catch (e) {
      // Refus définitif (contenu identique, droits…) : le fichier envoyé ne servira pas.
      if (!erreurReprenable(e)) {
        retirerOrphelin(fichierId);
        enAttente.current = null;
      }
      throw e;
    }
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setErreurFichier(null);
    const v = validerDepot(
      { type, nom, brouillonIa },
      typesPermis,
      fichier ? null : "Choisissez le fichier à déposer.",
    );
    await f.envoyer(v, (c) => deposer(c, fichier as File), {
      messageSpecifique: (e) => {
        const m = messageDocument(e);
        // Rappel court sous le champ ; le détail est dans l'alerte (focalisée).
        if (e instanceof ErreurApi && e.code in RAPPELS_FICHIER)
          setErreurFichier(RAPPELS_FICHIER[e.code]!);
        return m;
      },
      apres: (d) => {
        onDepose(
          d.version > 1
            ? `Version ${d.version} de « ${d.nom} » déposée.`
            : `Document « ${d.nom} » déposé.`,
        );
      },
    });
  }

  const titre = version ? `Nouvelle version de « ${version.nom} »` : "Déposer un document";
  const reprise = enAttente.current !== null && enAttente.current.fichier === fichier;
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Dépôt impossible"
      />
      {version ? (
        <p className="mp-texte-doux">
          {`Le fichier deviendra la version ${version.version_courante + 1} ; les versions précédentes restent consultables.`}
        </p>
      ) : null}
      <div className="mp-grille-champs">
        {version ? null : (
          <>
            <Select
              libelle="Type"
              required
              options={OPTIONS_TYPES_DOCUMENT.filter((o) => typesPermis.includes(o.valeur))}
              value={type}
              onChange={(e) => setType(e.target.value)}
              erreur={f.erreurs.type}
            />
            <Champ
              libelle="Nom du document"
              required
              maxLength={200}
              value={nom}
              onChange={(e) => {
                setNom(e.target.value);
                setNomSaisi(true);
              }}
              erreur={f.erreurs.nom}
              aide={
                courante
                  ? `Un document de ce type porte déjà ce nom : le dépôt créera sa version ${courante.version_courante + 1}.`
                  : "Même type et même nom qu'un document existant : nouvelle version de celui-ci."
              }
            />
          </>
        )}
      </div>
      <ChoixFichier
        libelle="Fichier"
        requis
        fichier={fichier}
        onChoix={(x) => {
          setErreurFichier(null);
          setFichier(x);
          if (x && !nomSaisi && !version) setNom(nomSansExtension(x.name).slice(0, 200));
        }}
        erreur={erreurFichier ?? f.erreurs.fichier}
        progression={progression}
      />
      {version ? null : (
        <CaseACocher
          libelle="Contenu généré par l'IA, à relire"
          aide="Le document portera le statut « Brouillon IA » : il devra être relu puis validé par un responsable de la mission avant tout envoi au client."
          checked={brouillonIa}
          onChange={(e) => setBrouillonIa(e.target.checked)}
        />
      )}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={reprise ? "nuage" : "envoyer"}
          chargement={f.enCours}
          texteChargement={progression !== null ? "Envoi du fichier…" : "Enregistrement…"}
        >
          {reprise ? "Réessayer le dépôt" : version ? "Déposer la version" : "Déposer"}
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
