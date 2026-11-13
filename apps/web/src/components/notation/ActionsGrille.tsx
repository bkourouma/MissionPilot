"use client";

import { useRouter } from "next/navigation";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { etatNotationChange } from "../../lib/notation";
import {
  cheminNouvelleVersion,
  cheminValiderVersion,
  hrefVersionGrille,
  messageGrille,
  type VersionGrille,
} from "../../lib/notation-grilles";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";

function useRetour() {
  const t = useT();
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erreur) ref.current?.focus();
  }, [erreur]);
  const rendu = (
    <>
      {erreur ? (
        <Alerte ref={ref} tonalite="danger" titre={t("Action refusée", "Action refused")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}
    </>
  );
  return { setErreur, setSucces, rendu };
}

/** Nouvelle version (brouillon) d'une grille, à partir de sa dernière version. */
export function NouvelleVersionGrille({ grilleId }: { grilleId: string }) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const r = useRetour();
  async function creer() {
    r.setErreur(null);
    try {
      const v = await api.post<VersionGrille>(cheminNouvelleVersion(grilleId), {});
      r.setSucces(
        t(
          `Version ${v.version} créée en brouillon : ouverture de l'éditeur.`,
          `Version ${v.version} created as a draft: opening the editor.`,
        ),
      );
      router.push(hrefVersionGrille(v.id));
      return true;
    } catch (e) {
      r.setErreur(messageGrille(e, langue));
      if (etatNotationChange(e)) rafraichir();
      return false;
    }
  }
  return (
    <div className="mp-pile">
      {r.rendu}
      <div className="mp-barre-actions">
        <BoutonConfirmation
          libelle={t("Créer une nouvelle version", "Create a new version")}
          question={t(
            "Créer un brouillon à partir de la dernière version ? La version validée reste inchangée et utilisable.",
            "Create a draft from the latest version? The approved version stays unchanged and usable.",
          )}
          libelleConfirmation={t("Oui, créer le brouillon", "Yes, create the draft")}
          texteChargement={t("Création…", "Creating…")}
          variante="primaire"
          icone="plus"
          action={creer}
        />
      </div>
    </div>
  );
}

/** Validation d'une version par un expert métier qui ne l'a ni rédigée ni modifiée. */
export function ValiderVersionGrille({
  versionId,
  numero,
  statut,
  sommesConformes,
}: {
  versionId: string;
  numero: number;
  statut: string;
  /** Les sommes de la version ENREGISTRÉE font 100 (sinon simple avertissement). */
  sommesConformes: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const r = useRetour();
  const [attente, attendre] = useAttenteRafraichissement(statut);
  async function valider() {
    if (attente) return false;
    r.setErreur(null);
    try {
      await api.post(cheminValiderVersion(versionId));
      r.setSucces(
        t(
          `Version ${numero} validée : elle est figée et peut servir au calcul.`,
          `Version ${numero} approved: it is locked and can be used for computation.`,
        ),
      );
      attendre();
      rafraichir();
      return true;
    } catch (e) {
      r.setErreur(messageGrille(e, langue));
      if (etatNotationChange(e)) rafraichir();
      return false;
    }
  }
  return (
    <div className="mp-pile">
      {r.rendu}
      {!sommesConformes ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            {t(
              "Les poids enregistrés ne totalisent pas 100 partout : le moteur les ramènera à 100 en proportion. Vérifiez que c'est voulu avant de valider.",
              "The saved weights do not total 100 everywhere: the engine will scale them to 100 proportionally. Check that this is intended before approving.",
            )}
          </p>
        </Alerte>
      ) : null}
      <div className="mp-barre-actions">
        <BoutonConfirmation
          libelle={t("Valider cette version", "Approve this version")}
          question={t(
            `Valider la version ${numero} telle qu'enregistrée ? Elle sera figée et pourra servir au calcul des notations.`,
            `Approve version ${numero} as saved? It will be locked and can be used to compute ratings.`,
          )}
          libelleConfirmation={t("Oui, valider", "Yes, approve")}
          texteChargement={t("Validation…", "Approving…")}
          variante="primaire"
          icone="succes"
          action={valider}
        />
      </div>
    </div>
  );
}
