"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { TypeDocument } from "@missionpilot/shared";
import { ChoixFichier } from "../../../../../components/fichiers/ChoixFichier";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
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
import { optionsTypesDocument } from "../../../../../lib/missions";
import { televerser } from "../../../../../lib/televersement";
import { useFocusInitial } from "../../../../../components/signatures/useFocusInitial";

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
const MESSAGE_IDENTIQUE_EN =
  "This file is identical to the current version of the document: no new version was created.";

const RAPPELS_FICHIER: Record<string, string> = {
  CONTENU_IDENTIQUE: "Fichier identique à la version courante : choisissez un autre fichier.",
  TYPE_FICHIER_REFUSE: "Fichier refusé par le serveur : choisissez-en un autre.",
  FICHIER_TROP_VOLUMINEUX: "Fichier trop volumineux : 15 Mo au plus.",
};
const RAPPELS_FICHIER_EN: Record<string, string> = {
  CONTENU_IDENTIQUE: "File identical to the current version: choose another file.",
  TYPE_FICHIER_REFUSE: "File refused by the server: choose another one.",
  FICHIER_TROP_VOLUMINEUX: "File too large: 15 MB at most.",
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
  const t = useT();
  const langue = useLangue();
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
  useFocusInitial(f.refFormulaire);
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
        throw new ErreurApi("CONTENU_IDENTIQUE", t(MESSAGE_IDENTIQUE, MESSAGE_IDENTIQUE_EN), 409);
    }
    let fichierId = enAttente.current?.fichier === f0 ? enAttente.current.id : null;
    if (!fichierId) {
      retirerOrphelin(enAttente.current?.id ?? null);
      enAttente.current = null;
      setProgression(0);
      try {
        const tv = await televerser<FichierTeleverse>("/api/fichiers", f0, f0.name, {
          onProgression: setProgression,
        });
        fichierId = tv.id;
        enAttente.current = { fichier: f0, id: tv.id };
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
      fichier ? null : t("Choisissez le fichier à déposer.", "Choose the file to upload."),
      langue,
    );
    await f.envoyer(v, (c) => deposer(c, fichier as File), {
      messageSpecifique: (e) => {
        const m = messageDocument(e, langue);
        // Rappel court sous le champ ; le détail est dans l'alerte (focalisée).
        if (e instanceof ErreurApi && e.code in RAPPELS_FICHIER)
          setErreurFichier((langue === "en" ? RAPPELS_FICHIER_EN : RAPPELS_FICHIER)[e.code]!);
        return m;
      },
      apres: (d) => {
        onDepose(
          d.version > 1
            ? t(
                `Version ${d.version} de « ${d.nom} » déposée.`,
                `Version ${d.version} of "${d.nom}" uploaded.`,
              )
            : t(`Document « ${d.nom} » déposé.`, `Document "${d.nom}" uploaded.`),
        );
      },
    });
  }

  const titre = version
    ? t(`Nouvelle version de « ${version.nom} »`, `New version of "${version.nom}"`)
    : t("Déposer un document", "Upload a document");
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
        titreErreur={t("Dépôt impossible", "Upload not possible")}
      />
      {version ? (
        <p className="mp-texte-doux">
          {t(
            `Le fichier deviendra la version ${version.version_courante + 1} ; les versions précédentes restent consultables.`,
            `The file will become version ${version.version_courante + 1}; previous versions remain viewable.`,
          )}
        </p>
      ) : null}
      <div className="mp-grille-champs mp-grille-champs--bas">
        {version ? null : (
          <>
            <Select
              libelle={t("Type", "Type")}
              required
              options={optionsTypesDocument(langue).filter((o) => typesPermis.includes(o.valeur))}
              value={type}
              onChange={(e) => setType(e.target.value)}
              erreur={f.erreurs.type}
            />
            <Champ
              libelle={t("Nom du document", "Document name")}
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
                  ? t(
                      `Un document de ce type porte déjà ce nom : le dépôt créera sa version ${courante.version_courante + 1}.`,
                      `A document of this type already has this name: the upload will create its version ${courante.version_courante + 1}.`,
                    )
                  : t(
                      "Même type et même nom qu'un document existant : nouvelle version de celui-ci.",
                      "Same type and name as an existing document: new version of it.",
                    )
              }
            />
          </>
        )}
      </div>
      <ChoixFichier
        libelle={t("Fichier", "File")}
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
          libelle={t("Contenu généré par l'IA, à relire", "AI-generated content, to be reviewed")}
          aide={t(
            "Le document portera le statut « Brouillon IA » : il devra être relu puis validé par un responsable de la mission avant tout envoi au client.",
            "The document will carry the \u201cAI draft\u201d status: it must be reviewed and then approved by an engagement lead before anything is sent to the client.",
          )}
          checked={brouillonIa}
          onChange={(e) => setBrouillonIa(e.target.checked)}
        />
      )}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={reprise ? "nuage" : "envoyer"}
          chargement={f.enCours}
          texteChargement={
            progression !== null
              ? t("Envoi du fichier…", "Uploading file…")
              : t("Enregistrement…", "Saving…")
          }
        >
          {reprise
            ? t("Réessayer le dépôt", "Retry the upload")
            : version
              ? t("Déposer la version", "Upload the version")
              : t("Déposer", "Upload")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
