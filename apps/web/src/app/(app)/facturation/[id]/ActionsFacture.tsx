"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useFermetureDifferee } from "../../../../components/formulaires/useFermetureDifferee";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { ZoneTexte } from "../../../../components/ui/ZoneTexte";
import { api } from "../../../../lib/api";
import {
  messageFacture,
  validerEnTete,
  validerMotif,
  type ActionsFacture as Actions,
  type ChampEnTete,
  type FactureDetaillee,
  type SaisieEnTete,
} from "../../../../lib/factures";
import { montantVersSaisie } from "../../../../lib/saisie";
import { ChampsRemise } from "./ContenuFacture";

type Panneau = "entete" | "rejet" | "avoir" | null;

/** Circuit de la facture : actions permises par le rôle et le statut (l'API reste seule juge). */
export function ActionsFacture({
  facture: f,
  actions: a,
}: {
  facture: FactureDetaillee;
  actions: Actions;
}) {
  const router = useRouter();
  const cle = `${f.statut}-${f.modifie_le}-${f.envoyee_le}`;
  const [panneau, setPanneau, fermerApresRafraichissement] =
    useFermetureDifferee<Exclude<Panneau, null>>(cle);
  const op = useFormulaire<never>();
  const [attente, marquer] = useAttenteRafraichissement(
    `${f.statut}-${f.modifie_le}-${f.envoyee_le}`,
  );
  const chemin = `/api/factures/${encodeURIComponent(f.id)}`;
  const occupe = op.enCours || attente;
  const poster = (suffixe: string, succes: string) =>
    op.envoyer({ ok: true, charge: null }, () => api.post(`${chemin}/${suffixe}`), {
      succes,
      apres: marquer,
      messageSpecifique: messageFacture,
    });
  const aucune = !Object.entries(a).some(([k, v]) => k !== "raisonRefusApprobation" && v === true);
  if (aucune) return null;

  return (
    <Carte titre="Actions">
      <div className="mp-pile">
        <RetourFormulaire
          erreur={op.erreurGlobale}
          succes={op.succes}
          refAlerte={op.refAlerte}
          titreErreur="Action impossible"
        />
        <div className="mp-barre-actions">
          {a.modifier ? (
            <Bouton
              variante="secondaire"
              icone="crayon"
              aria-expanded={panneau === "entete"}
              onClick={() => setPanneau(panneau === "entete" ? null : "entete")}
            >
              Objet, remise, retenue et délai
            </Bouton>
          ) : null}
          {a.soumettre ? (
            <Bouton
              icone="envoyer"
              chargement={occupe}
              texteChargement="Soumission…"
              onClick={() => poster("soumettre", "Facture soumise à approbation.")}
            >
              Soumettre à approbation
            </Bouton>
          ) : null}
          {a.approuver ? (
            <Bouton
              icone="succes"
              chargement={occupe}
              texteChargement="Approbation…"
              onClick={() => poster("approuver", "Facture approuvée.")}
            >
              Approuver
            </Bouton>
          ) : null}
          {a.rejeter ? (
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "rejet"}
              onClick={() => setPanneau(panneau === "rejet" ? null : "rejet")}
            >
              Rejeter
            </Bouton>
          ) : null}
          {a.emettre ? (
            <BoutonConfirmation
              libelle="Émettre la facture"
              variante="primaire"
              icone="signature"
              question="Émettre cette facture ? Elle reçoit son numéro définitif et ne pourra plus être modifiée : seule une annulation par avoir sera possible."
              libelleConfirmation="Oui, émettre"
              texteChargement="Émission…"
              action={() => poster("emettre", "Facture émise : numéro définitif attribué.")}
            />
          ) : null}
          {a.marquerEnvoyee ? (
            <BoutonConfirmation
              libelle="Marquer comme envoyée"
              icone="courrier"
              question="Confirmer que la facture a été envoyée au client ? Cette mention ne s'annule pas."
              libelleConfirmation="Oui, marquer envoyée"
              texteChargement="Enregistrement…"
              action={() => poster("marquer-envoyee", "Facture marquée comme envoyée.")}
            />
          ) : null}
          {a.avoir ? (
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "avoir"}
              onClick={() => setPanneau(panneau === "avoir" ? null : "avoir")}
            >
              Annuler par un avoir
            </Bouton>
          ) : null}
          {a.supprimer ? (
            <BoutonConfirmation
              libelle="Supprimer le brouillon"
              variante="discret"
              icone="corbeille"
              question="Supprimer ce brouillon ? Ses échéances et débours redeviennent facturables."
              libelleConfirmation="Oui, supprimer"
              texteChargement="Suppression…"
              action={() =>
                op.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin), {
                  rafraichir: false,
                  apres: () => router.push("/facturation"),
                  messageSpecifique: messageFacture,
                })
              }
            />
          ) : null}
        </div>
        {panneau === "entete" ? (
          <FormulaireEnTete
            facture={f}
            onFin={() => setPanneau(null)}
            onEnregistre={fermerApresRafraichissement}
          />
        ) : null}
        {panneau === "rejet" ? (
          <FormulaireMotif
            titre="Rejeter la facture"
            aide="La facture revient en brouillon ; le motif est affiché à son auteur."
            bouton="Rejeter la facture"
            appel={(c) => api.post(`${chemin}/rejeter`, c)}
            onFin={() => setPanneau(null)}
            onEnregistre={fermerApresRafraichissement}
          />
        ) : null}
        {panneau === "avoir" ? (
          <FormulaireMotif
            titre="Annuler par un avoir total"
            aide="Un avoir en brouillon reprend toute la facture. À son émission, la facture est annulée et ses échéances et débours redeviennent facturables."
            bouton="Créer l'avoir (brouillon)"
            appel={(c) => api.post<{ id: string }>(`${chemin}/avoir`, c)}
            onFin={() => setPanneau(null)}
            onEnregistre={fermerApresRafraichissement}
            apres={(r) => router.push(`/facturation/${(r as { id: string }).id}`)}
          />
        ) : null}
      </div>
    </Carte>
  );
}

function FormulaireEnTete({
  facture: f,
  onFin,
  onEnregistre,
}: {
  facture: FactureDetaillee;
  onFin: () => void;
  onEnregistre: () => void;
}) {
  const [s, setS] = useState<SaisieEnTete>({
    objet: f.objet ?? "",
    remise: {
      type: f.remise_globale_type ?? "",
      valeur:
        f.remise_globale_valeur === null
          ? ""
          : f.remise_globale_type === "montant"
            ? montantVersSaisie(f.remise_globale_valeur, f.devise)
            : String(f.remise_globale_valeur).replace(".", ","),
    },
    retenue_active: f.retenue_active,
    delai_paiement_jours: String(f.delai_paiement_jours),
  });
  const form = useFormulaire<ChampEnTete>();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(
      validerEnTete(s, f.devise),
      (c) => api.patch(`/api/factures/${encodeURIComponent(f.id)}`, c),
      {
        apres: onEnregistre,
        messageSpecifique: messageFacture,
      },
    );
  }
  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Objet, remise, retenue et délai"
    >
      <RetourFormulaire erreur={form.erreurGlobale} refAlerte={form.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Objet"
          maxLength={300}
          value={s.objet}
          onChange={(e) => setS((x) => ({ ...x, objet: e.target.value }))}
          erreur={form.erreurs.objet}
        />
        <ChampsRemise
          libelle="Remise globale"
          saisie={s.remise}
          devise={f.devise}
          erreur={form.erreurs.remise}
          onChange={(remise) => setS((x) => ({ ...x, remise }))}
        />
        <Champ
          libelle="Délai de paiement (jours)"
          required
          inputMode="numeric"
          value={s.delai_paiement_jours}
          onChange={(e) => setS((x) => ({ ...x, delai_paiement_jours: e.target.value }))}
          erreur={form.erreurs.delai_paiement_jours}
        />
      </div>
      <CaseACocher
        libelle={`Appliquer la retenue (${f.retenue_libelle})`}
        checked={s.retenue_active}
        onChange={(e) => setS((x) => ({ ...x, retenue_active: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={form.enCours} texteChargement="Recalcul…">
          Enregistrer et recalculer
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireMotif({
  titre,
  aide,
  bouton,
  appel,
  onFin,
  onEnregistre,
  apres,
}: {
  titre: string;
  aide: string;
  bouton: string;
  appel: (c: { motif: string }) => Promise<unknown>;
  onFin: () => void;
  onEnregistre: () => void;
  apres?: (r: unknown) => void;
}) {
  const [motif, setMotif] = useState("");
  const form = useFormulaire<"motif">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await form.envoyer(validerMotif(motif), appel, {
      rafraichir: !apres,
      apres: apres ?? onEnregistre,
      messageSpecifique: messageFacture,
    });
  }
  return (
    <form
      ref={form.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={form.erreurGlobale} refAlerte={form.refAlerte} />
      <ZoneTexte
        libelle="Motif"
        aide={aide}
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={form.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="danger"
          chargement={form.enCours}
          texteChargement="Enregistrement…"
        >
          {bouton}
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
