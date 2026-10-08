"use client";

import { useRouter } from "next/navigation";
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
import { Alerte } from "../ui/Alerte";

function useRetour() {
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erreur) ref.current?.focus();
  }, [erreur]);
  const rendu = (
    <>
      {erreur ? (
        <Alerte ref={ref} tonalite="danger" titre="Action refusée">
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
  const r = useRetour();
  async function creer() {
    r.setErreur(null);
    try {
      const v = await api.post<VersionGrille>(cheminNouvelleVersion(grilleId), {});
      r.setSucces(`Version ${v.version} créée en brouillon : ouverture de l'éditeur.`);
      router.push(hrefVersionGrille(v.id));
      return true;
    } catch (e) {
      r.setErreur(messageGrille(e));
      if (etatNotationChange(e)) router.refresh();
      return false;
    }
  }
  return (
    <div className="mp-pile">
      {r.rendu}
      <div className="mp-barre-actions">
        <BoutonConfirmation
          libelle="Créer une nouvelle version"
          question="Créer un brouillon à partir de la dernière version ? La version validée reste inchangée et utilisable."
          libelleConfirmation="Oui, créer le brouillon"
          texteChargement="Création…"
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
  const router = useRouter();
  const r = useRetour();
  const [attente, attendre] = useAttenteRafraichissement(statut);
  async function valider() {
    if (attente) return false;
    r.setErreur(null);
    try {
      await api.post(cheminValiderVersion(versionId));
      r.setSucces(`Version ${numero} validée : elle est figée et peut servir au calcul.`);
      attendre();
      router.refresh();
      return true;
    } catch (e) {
      r.setErreur(messageGrille(e));
      if (etatNotationChange(e)) router.refresh();
      return false;
    }
  }
  return (
    <div className="mp-pile">
      {r.rendu}
      {!sommesConformes ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            Les poids enregistrés ne totalisent pas 100 partout : le moteur les ramènera à 100 en
            proportion. Vérifiez que c&apos;est voulu avant de valider.
          </p>
        </Alerte>
      ) : null}
      <div className="mp-barre-actions">
        <BoutonConfirmation
          libelle="Valider cette version"
          question={`Valider la version ${numero} telle qu'enregistrée ? Elle sera figée et pourra servir au calcul des notations.`}
          libelleConfirmation="Oui, valider"
          texteChargement="Validation…"
          variante="primaire"
          icone="succes"
          action={valider}
        />
      </div>
    </div>
  );
}
