"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { StatutMission } from "@missionpilot/shared";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Champ } from "../../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../../components/ui/Select";
import { api } from "../../../../lib/api";
import type { Devise } from "../../../../lib/format";
import {
  aujourdhuiIso,
  codeDepuisLibelle,
  deviseFlottante,
  validerDuplication,
  validerModele,
  validerSignature,
  type ChargeSignature,
  type DroitsMission,
  type Mission,
  type NatureSupplementaire,
  type SaisieSignature,
} from "../../../../lib/missions";
import { aideMontant } from "../../../../lib/saisie";

export interface ActionsMissionProps {
  mission: {
    id: string;
    intitule: string;
    statut: StatutMission;
    devise: Devise;
    directeurDesigne: boolean;
  };
  droits: DroitsMission;
  /** Natures de lignes saisissables à la signature (selon les droits financiers). */
  natures: NatureSupplementaire[];
  /** Saisir un taux de change flottant (USD) : « finance.lire » ou associé. */
  peutSaisirTaux: boolean;
  clients: readonly OptionSelect[];
}

/** Cycle de vie : transitions, signature (budget figé), clôture, duplication, modèle. */
export function ActionsMission({
  mission,
  droits,
  natures,
  peutSaisirTaux,
  clients,
}: ActionsMissionProps) {
  const f = useFormulaire<never>();
  const chemin = `/api/missions/${encodeURIComponent(mission.id)}`;
  const [panneau, setPanneau] = useState<"aucun" | "duplication" | "modele">("aucun");
  // Conservé au niveau de la carte : après signature, le formulaire disparaît (statut « signée »).
  const [signee, setSignee] = useState(false);
  const [attente, marquerAttente] = useAttenteRafraichissement(mission.statut);
  const rien =
    droits.transitions.length === 0 &&
    !droits.signer &&
    !droits.cloturer &&
    !droits.dupliquer &&
    !droits.enregistrerModele;
  if (rien) return null;

  return (
    <Carte titre="Cycle de vie">
      <div className="mp-pile">
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur="Action impossible"
        />
        {signee ? (
          <Alerte tonalite="succes" titre="Lettre de mission signée">
            <p>Le budget initial est figé (version 1). Consultez-le dans l&apos;onglet Budget.</p>
          </Alerte>
        ) : null}
        {attente ? (
          <p className="mp-texte-doux" role="status">
            Mise à jour de la page…
          </p>
        ) : droits.transitions.length > 0 || droits.cloturer ? (
          <div className="mp-barre-actions">
            {droits.transitions.map((t) => (
              <Bouton
                key={t.cible}
                variante="secondaire"
                chargement={f.enCours}
                texteChargement="Mise à jour…"
                onClick={() =>
                  f.envoyer(
                    { ok: true, charge: { statut: t.cible } },
                    (c) => api.post(`${chemin}/statut`, c),
                    {
                      succes: "Statut mis à jour.",
                      apres: marquerAttente,
                    },
                  )
                }
              >
                {t.libelle}
              </Bouton>
            ))}
            {droits.cloturer ? (
              <BoutonConfirmation
                libelle="Clôturer la mission"
                icone="cadenas"
                variante="primaire"
                question="Clôturer définitivement la mission ? Elle ne pourra plus être modifiée."
                libelleConfirmation="Oui, clôturer"
                texteChargement="Clôture…"
                action={() =>
                  f.envoyer({ ok: true, charge: null }, () => api.post(`${chemin}/cloturer`), {
                    succes: "Mission clôturée.",
                    apres: marquerAttente,
                  })
                }
              />
            ) : null}
          </div>
        ) : null}

        {droits.signer ? (
          mission.directeurDesigne ? (
            <Signature
              missionId={mission.id}
              devise={mission.devise}
              natures={natures}
              peutSaisirTaux={peutSaisirTaux}
              onSignee={() => setSignee(true)}
            />
          ) : (
            <Alerte
              tonalite="attention"
              titre="Signature impossible pour l'instant"
              annonce="aucune"
            >
              <p>
                Désignez d&apos;abord le directeur de mission (bouton « Modifier » de la fiche).
              </p>
            </Alerte>
          )
        ) : null}

        {droits.dupliquer || droits.enregistrerModele ? (
          <div className="mp-barre-actions">
            {droits.dupliquer ? (
              <Bouton
                variante="secondaire"
                icone="copie"
                aria-expanded={panneau === "duplication"}
                onClick={() => setPanneau((p) => (p === "duplication" ? "aucun" : "duplication"))}
              >
                Dupliquer
              </Bouton>
            ) : null}
            {droits.enregistrerModele ? (
              <Bouton
                variante="secondaire"
                icone="livre"
                aria-expanded={panneau === "modele"}
                onClick={() => setPanneau((p) => (p === "modele" ? "aucun" : "modele"))}
              >
                Enregistrer comme modèle
              </Bouton>
            ) : null}
          </div>
        ) : null}
        {panneau === "duplication" ? (
          <Duplication
            missionId={mission.id}
            intitule={mission.intitule}
            clients={clients}
            onFin={() => setPanneau("aucun")}
          />
        ) : null}
        {panneau === "modele" ? (
          <Modele
            missionId={mission.id}
            intitule={mission.intitule}
            onFin={() => setPanneau("aucun")}
          />
        ) : null}
      </div>
    </Carte>
  );
}

/**
 * Signature de la lettre de mission (MIS-07) en deux temps : la saisie est validée, puis un
 * rappel explicite que le budget initial sera FIGÉ demande une confirmation.
 */
function Signature({
  missionId,
  devise,
  natures,
  peutSaisirTaux,
  onSignee,
}: {
  missionId: string;
  devise: Devise;
  natures: NatureSupplementaire[];
  peutSaisirTaux: boolean;
  onSignee: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [s, setS] = useState<SaisieSignature>({
    date_signature: aujourdhuiIso(),
    taux_change: "",
    lignes: [],
  });
  const [aConfirmer, setAConfirmer] = useState<ChargeSignature | null>(null);
  const [erreursLocales, setErreursLocales] = useState<Partial<Record<string, string>>>({});
  const f = useFormulaire<string>();
  const refConfirmer = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (aConfirmer) refConfirmer.current?.focus();
  }, [aConfirmer]);

  function preparer(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = validerSignature(s, devise, natures);
    if (!v.ok) {
      setErreursLocales(v.erreurs);
      return;
    }
    setErreursLocales({});
    setAConfirmer(v.charge);
  }

  async function signer() {
    if (!aConfirmer) return;
    const ok = await f.envoyer(
      { ok: true, charge: aConfirmer },
      (c) => api.post(`/api/missions/${encodeURIComponent(missionId)}/signer`, c),
      { apres: onSignee },
    );
    if (!ok) setAConfirmer(null);
  }

  const majLigne = (i: number, champ: string, v: string | boolean) =>
    setS((x) => ({
      ...x,
      lignes: x.lignes.map((l, k) => (k === i ? { ...l, [champ]: v } : l)),
    }));
  const erreurs = { ...erreursLocales, ...f.erreurs };

  if (!ouvert) {
    return (
      <div>
        <Bouton icone="signature" onClick={() => setOuvert(true)}>
          Signer la lettre de mission
        </Bouton>
      </div>
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={preparer}
      aria-label="Signer la lettre de mission"
    >
      <p className="mp-sous-formulaire__titre">Signature de la lettre de mission</p>
      <Alerte tonalite="attention" titre="Le budget initial sera figé" annonce="aucune">
        <p>
          À la signature, le budget est calculé depuis les jours budgétés du découpage, puis{" "}
          <strong>figé</strong> : il ne pourra plus être modifié. Toute évolution passera par une
          révision motivée, validée par le directeur de mission.
        </p>
      </Alerte>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Signature impossible"
      />
      {deviseFlottante(devise) && !peutSaisirTaux ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>
            {`Le taux de change ${devise} est saisi par un associé ou un gestionnaire : demandez-lui de signer.`}
          </p>
        </Alerte>
      ) : !deviseFlottante(devise) ? (
        <p className="mp-texte-doux">
          {devise === "EUR"
            ? "Parité légale euro / franc CFA (655,957) appliquée automatiquement."
            : "Taux de change appliqué automatiquement (parité fixe)."}
        </p>
      ) : null}
      <div className="mp-grille-champs">
        <Champ
          libelle="Date de signature"
          name="date_signature"
          type="date"
          required
          value={s.date_signature}
          onChange={(e) => setS((x) => ({ ...x, date_signature: e.target.value }))}
          erreur={erreurs.date_signature}
        />
        {deviseFlottante(devise) && peutSaisirTaux ? (
          <Champ
            libelle={`Taux de change : 1 ${devise} = … (devise du cabinet)`}
            name="taux_change"
            required
            inputMode="decimal"
            autoComplete="off"
            value={s.taux_change}
            onChange={(e) => setS((x) => ({ ...x, taux_change: e.target.value }))}
            erreur={erreurs.taux_change}
            aide="Figé à la signature pour toute la mission."
          />
        ) : null}
      </div>
      {natures.length > 0 ? (
        <fieldset className="mp-groupe">
          <legend className="mp-champ__libelle">Lignes supplémentaires (facultatives)</legend>
          <p className="mp-champ__aide">{`Débours${natures.includes("sous_traitance") ? " ou sous-traitance" : ""} prévus, au forfait. ${aideMontant(devise)}`}</p>
          {s.lignes.map((l, i) => (
            <div key={i} className="mp-ligne-saisie">
              <Select
                libelle={`Nature (ligne ${i + 1})`}
                options={natures.map((n) => ({
                  valeur: n,
                  libelle: n === "debours" ? "Débours" : "Sous-traitance",
                }))}
                value={l.nature}
                onChange={(e) => majLigne(i, "nature", e.target.value)}
                erreur={erreurs[`lignes.${i}.nature`]}
              />
              <Champ
                libelle={`Libellé (ligne ${i + 1})`}
                maxLength={200}
                value={l.libelle}
                onChange={(e) => majLigne(i, "libelle", e.target.value)}
                erreur={erreurs[`lignes.${i}.libelle`]}
              />
              <Champ
                libelle={`Montant en ${devise} (ligne ${i + 1})`}
                inputMode="decimal"
                autoComplete="off"
                value={l.montant}
                onChange={(e) => majLigne(i, "montant", e.target.value)}
                erreur={erreurs[`lignes.${i}.montant`]}
              />
              {l.nature === "debours" ? (
                <CaseACocher
                  libelle="Refacturable au client"
                  checked={l.refacturable}
                  onChange={(e) => majLigne(i, "refacturable", e.target.checked)}
                />
              ) : null}
              <div>
                <Bouton
                  variante="discret"
                  icone="corbeille"
                  onClick={() =>
                    setS((x) => ({ ...x, lignes: x.lignes.filter((_, k) => k !== i) }))
                  }
                >
                  {`Retirer la ligne ${i + 1}`}
                </Bouton>
              </div>
            </div>
          ))}
          <div>
            <Bouton
              variante="secondaire"
              icone="plus"
              disabled={s.lignes.length >= 50}
              onClick={() =>
                setS((x) => ({
                  ...x,
                  lignes: [
                    ...x.lignes,
                    {
                      nature: natures[0] as NatureSupplementaire,
                      libelle: "",
                      montant: "",
                      refacturable: false,
                    },
                  ],
                }))
              }
            >
              Ajouter une ligne
            </Bouton>
          </div>
        </fieldset>
      ) : null}

      {aConfirmer ? (
        <div className="mp-confirmation" role="group" aria-label="Confirmer la signature">
          <p className="mp-confirmation__question">
            Confirmer la signature ? Le budget initial sera FIGÉ et ne pourra plus être modifié.
          </p>
          <div className="mp-confirmation__boutons">
            <Bouton
              ref={refConfirmer}
              variante="danger"
              icone="cadenas"
              chargement={f.enCours}
              texteChargement="Signature…"
              onClick={signer}
            >
              Oui, signer et figer le budget
            </Bouton>
            <Bouton variante="secondaire" disabled={f.enCours} onClick={() => setAConfirmer(null)}>
              Revenir à la saisie
            </Bouton>
          </div>
        </div>
      ) : (
        <div className="mp-actions-formulaire">
          <Bouton type="submit" icone="signature">
            Continuer vers la confirmation
          </Bouton>
          <Bouton variante="discret" onClick={() => setOuvert(false)}>
            Annuler
          </Bouton>
        </div>
      )}
    </form>
  );
}

function Duplication({
  missionId,
  intitule,
  clients,
  onFin,
}: {
  missionId: string;
  intitule: string;
  clients: readonly OptionSelect[];
  onFin: () => void;
}) {
  const router = useRouter();
  const [titre, setTitre] = useState(`${intitule} (copie)`.slice(0, 200));
  const [client, setClient] = useState("");
  const f = useFormulaire<"intitule" | "client_id">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerDuplication(titre, client),
      (c) => api.post<Mission>(`/api/missions/${encodeURIComponent(missionId)}/dupliquer`, c),
      {
        rafraichir: false,
        apres: (m) => {
          router.push(`/missions/${m.id}`);
          router.refresh();
        },
      },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Dupliquer la mission"
    >
      <p className="mp-sous-formulaire__titre">Dupliquer la mission</p>
      <p className="mp-texte-doux">
        La copie reprend le découpage, les jours budgétés et les dépendances, sans dates ni budget
        signé.
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Duplication impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Intitulé de la copie"
          required
          maxLength={200}
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          erreur={f.erreurs.intitule}
        />
        <Select
          libelle="Client de la copie"
          options={clients}
          invite="Même client"
          value={client}
          onChange={(e) => setClient(e.target.value)}
          erreur={f.erreurs.client_id}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="copie" chargement={f.enCours} texteChargement="Duplication…">
          Créer la copie
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

function Modele({
  missionId,
  intitule,
  onFin,
}: {
  missionId: string;
  intitule: string;
  onFin: () => void;
}) {
  const router = useRouter();
  const [libelle, setLibelle] = useState(intitule.slice(0, 160));
  const [code, setCode] = useState(codeDepuisLibelle(intitule));
  const f = useFormulaire<"code" | "libelle">();
  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerModele(code, libelle),
      (c) => api.post<{ id: string }>(`/api/missions/${encodeURIComponent(missionId)}/modele`, c),
      { rafraichir: false, apres: (t) => router.push(`/catalogue/${t.id}`) },
    );
  }
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Enregistrer comme modèle"
    >
      <p className="mp-sous-formulaire__titre">Enregistrer comme type de mission</p>
      <p className="mp-texte-doux">
        Le découpage et les jours par grade deviennent un nouveau type du catalogue.
      </p>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Code du type"
          required
          maxLength={40}
          autoCapitalize="none"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          erreur={f.erreurs.code}
          aide="Minuscules, chiffres et tiret bas."
        />
        <Champ
          libelle="Libellé du type"
          required
          maxLength={160}
          value={libelle}
          onChange={(e) => setLibelle(e.target.value)}
          erreur={f.erreurs.libelle}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="livre"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Enregistrer le modèle
        </Bouton>
        <Bouton variante="discret" onClick={onFin}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
